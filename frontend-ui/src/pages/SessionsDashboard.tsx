import { useState, useEffect } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Users } from 'lucide-react'
import { apiClient } from '../services/ApiClient'
import { useThemeStore } from '../store/themeStore'
import CreateSessionModal from '../components/modals/CreateSessionModal'
import EditSessionModal from '../components/modals/EditSessionModal'
import DeleteSessionModal from '../components/modals/DeleteSessionModal'
import CloseSessionModal from '../components/modals/CloseSessionModal'
import PublicLinkModal from '../components/modals/PublicLinkModal'
import ShareProjectModal from '../components/modals/ShareProjectModal'
import ProfileButton from '../components/layout/ProfileButton'
import { ProjectOverviewBanner } from '../components/dashboard/ProjectOverviewBanner'
import { useToastStore } from '../store/toastStore'
import type { SessionListItem, SessionStatus, ProjectWithSessions, ListenerStatus, ProjectSessionEvent } from '../lib/api-types'

export default function SessionsDashboard() {
  const navigate = useNavigate()
  const { projectId } = useParams<{ projectId: string }>()
  const { addToast } = useToastStore()
  const { resolvedTheme, initializeTheme } = useThemeStore()
  const isDark = resolvedTheme === 'dark'

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
  const [isPublicLinkModalOpen, setIsPublicLinkModalOpen] = useState(false)
  const [isShareModalOpen, setIsShareModalOpen] = useState(false)

  // Initialize theme on mount
  useEffect(() => {
    initializeTheme()
  }, [initializeTheme])

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

  // Subscribe to real-time project events via SSE
  useEffect(() => {
    if (!projectId) return

    const unsubscribe = apiClient.subscribeToProjectEvents(
      projectId,
      (event: ProjectSessionEvent) => {
        console.log('[SessionsDashboard] Received project event:', event)

        switch (event.type) {
          case 'session.created':
            // Reload sessions to get full session data with counts
            // No toast - silent update to avoid spam when many participants join
            loadData()
            break

          case 'session.closed':
            // Update session status in local state
            setSessions(prev =>
              prev.map(s =>
                s.id === event.sessionId
                  ? { ...s, status: 'CLOSED' as SessionStatus }
                  : s
              )
            )
            break

          case 'session.deleted':
            // Remove session from local state
            setSessions(prev => prev.filter(s => s.id !== event.sessionId))
            break
        }
      },
      (error) => {
        console.error('[SessionsDashboard] SSE connection error:', error)
        // EventSource auto-reconnects, just log the error
      }
    )

    return () => {
      console.log('[SessionsDashboard] Cleaning up SSE subscription')
      unsubscribe()
    }
  }, [projectId])

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
    <div className={`min-h-screen transition-colors duration-200 ${
      isDark ? 'bg-surface-dark' : 'bg-surface'
    }`}>
      {/* Header */}
      <header className={`sticky top-0 z-40 border-b transition-colors duration-200 ${
        isDark ? 'bg-surface-dark/95 border-border-dark' : 'bg-white/95 border-border'
      } backdrop-blur-sm`}>
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Back Button */}
            <Link
              to="/dashboard"
              className="btn-ghost p-2"
              title="Back to projects"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
            </Link>

            {/* Breadcrumb and Title */}
            <div>
              {/* Breadcrumb */}
              <div className={`flex items-center gap-2 text-caption mb-0.5 ${
                isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'
              }`}>
                <Link
                  to="/dashboard"
                  className={`transition-colors duration-200 ${
                    isDark ? 'hover:text-content-inverse' : 'hover:text-content'
                  }`}
                >
                  Projects
                </Link>
                <span>/</span>
                <span className={isDark ? 'text-content-inverse' : 'text-content'}>
                  {project?.name || 'Loading...'}
                </span>
              </div>

              {/* Title */}
              <h1 className={`text-heading-sm font-semibold tracking-tight ${
                isDark ? 'text-content-inverse' : 'text-content'
              }`}>
                {project?.name || 'Project Sessions'}
              </h1>
            </div>
          </div>

          {/* Right side - Profile */}
          <div className="flex items-center gap-1">
            <ProfileButton />
          </div>
        </div>
      </header>

      {/* Project Overview Banner - shows for all projects with public/private badge */}
      {projectId && (
        <ProjectOverviewBanner projectId={projectId} isPublic={project?.isPublic} />
      )}

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* Actions Bar */}
        <motion.div
          className="mb-6 flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <div className="flex gap-3 items-center flex-wrap">
            {/* Create Button - Show "Invite Participant" for public projects */}
            {project?.isPublic ? (
              <button
                onClick={() => setIsPublicLinkModalOpen(true)}
                className="btn-primary flex items-center gap-2"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="8.5" cy="7" r="4" />
                  <line x1="20" y1="8" x2="20" y2="14" />
                  <line x1="23" y1="11" x2="17" y2="11" />
                </svg>
                Invite Participant
              </button>
            ) : (
              <button
                onClick={() => setIsCreateModalOpen(true)}
                className="btn-primary flex items-center gap-2"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                New Session
              </button>
            )}

            {/* Share Button */}
            <button
              onClick={() => setIsShareModalOpen(true)}
              className="btn-secondary flex items-center gap-2"
            >
              <Users className="w-4 h-4" />
              Share
            </button>

            {/* Filter by Status */}
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as SessionStatus | 'ALL')}
              className={`input-field w-auto py-2.5 ${
                isDark ? '' : ''
              }`}
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
              className="input-field pl-10"
            />
            <svg
              className={`absolute left-3 top-1/2 -translate-y-1/2 ${
                isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'
              }`}
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
            <div className={`text-body ${isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'}`}>
              Loading sessions...
            </div>
          </div>
        )}

        {/* Error State */}
        {error && !isLoading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className={`p-4 rounded-lg text-body ${
              isDark
                ? 'bg-red-500/10 border border-red-500/20 text-red-400'
                : 'bg-red-50 border border-red-200 text-red-700'
            }`}
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
            {project?.isPublic ? (
              // Public project empty state - focus on inviting participants
              <>
                <div className={`w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center ${
                  isDark ? 'bg-violet-500/20' : 'bg-neutral-100'
                }`}>
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" className={
                    isDark ? 'text-violet-400' : 'text-neutral-900'
                  } stroke="currentColor" strokeWidth="1.5">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                </div>
                <h3 className={`text-heading mb-2 ${isDark ? 'text-content-inverse' : 'text-content'}`}>
                  Ready to invite participants
                </h3>
                <p className={`text-body mb-2 max-w-md mx-auto ${isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'}`}>
                  Share your public link to invite participants. Each person who opens the link will get their own private session with your pre-configured agent.
                </p>
                <p className={`text-body-sm mb-6 ${isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'}`}>
                  Sessions will appear here as participants join.
                </p>
                <button
                  onClick={() => setIsPublicLinkModalOpen(true)}
                  className="btn-primary flex items-center gap-2 mx-auto"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="2" y1="12" x2="22" y2="12" />
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                  </svg>
                  Get Public Link
                </button>
              </>
            ) : (
              // Regular project empty state
              <>
                <div className={`w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center ${
                  isDark ? 'bg-surface-dark-secondary' : 'bg-surface-secondary'
                }`}>
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" className={
                    isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'
                  } stroke="currentColor" strokeWidth="1.5">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" />
                  </svg>
                </div>
                <h3 className={`text-heading mb-2 ${isDark ? 'text-content-inverse' : 'text-content'}`}>
                  No sessions yet
                </h3>
                <p className={`text-body mb-6 ${isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'}`}>
                  Create your first session to start a conversation
                </p>
                <button
                  onClick={() => setIsCreateModalOpen(true)}
                  className="btn-primary"
                >
                  Create Session
                </button>
              </>
            )}
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
                  hidden: { opacity: 0, y: 10 },
                  visible: { opacity: 1, y: 0 },
                }}
                className={`group cursor-pointer rounded-xl p-5 transition-all duration-200 ${
                  isDark
                    ? 'bg-surface-dark-secondary border border-border-dark hover:border-border-dark-secondary'
                    : 'bg-white border border-border shadow-sm hover:shadow-md hover:border-border-secondary'
                }`}
                onClick={() => navigate(`/session/${session.id}`)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    {/* Session Name & Status */}
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className={`text-heading-sm ${isDark ? 'text-content-inverse' : 'text-content'}`}>
                        {session.name || `Session ${new Date(session.createdAt).toLocaleDateString()}`}
                      </h3>
                      <span className={session.status === 'ACTIVE' ? 'badge-success' : 'badge-neutral'}>
                        {session.status}
                      </span>
                    </div>

                    {/* Room Name */}
                    <div className={`text-caption font-mono mb-3 ${
                      isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'
                    }`}>
                      {session.room.livekitRoomName}
                    </div>

                    {/* Stats */}
                    <div className={`flex gap-6 text-body-sm ${
                      isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'
                    }`}>
                      <div>
                        <span className={`font-medium ${isDark ? 'text-content-inverse' : 'text-content'}`}>
                          {session._count.agents}
                        </span>{' '}
                        agents
                      </div>
                      <div>
                        <span className={`font-medium ${isDark ? 'text-content-inverse' : 'text-content'}`}>
                          {session._count.participants}
                        </span>{' '}
                        participants
                      </div>
                      <div>
                        <span className={`font-medium ${isDark ? 'text-content-inverse' : 'text-content'}`}>
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
                            className={`status-dot ${
                              isRecording
                                ? 'status-dot-error animate-pulse'
                                : isReconnecting
                                  ? 'status-dot-warning'
                                  : 'status-dot-neutral'
                            }`}
                            title={
                              isRecording
                                ? 'Recording active'
                                : isReconnecting
                                  ? 'Reconnecting...'
                                  : 'Not recording'
                            }
                          />
                          <span className={`text-label uppercase ${
                            isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'
                          }`}>
                            {isRecording ? 'RECORDING' : isReconnecting ? 'RECONNECTING' : 'IDLE'}
                          </span>
                        </div>
                      )
                    })()}

                    {/* Created Date */}
                    <p className={`text-caption mt-2 ${
                      isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'
                    }`}>
                      Created {new Date(session.createdAt).toLocaleString()}
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        navigate(`/session/${session.id}`)
                      }}
                      className="btn-primary text-ui-sm py-2"
                    >
                      Open
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setEditingSession(session)
                      }}
                      className={`p-2 rounded-lg transition-colors ${
                        isDark
                          ? 'text-content-inverse-tertiary hover:text-content-inverse hover:bg-surface-dark-tertiary'
                          : 'text-content-tertiary hover:text-content hover:bg-surface-secondary'
                      }`}
                      title="Edit session"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
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
                        className={`p-2 rounded-lg transition-colors ${
                          isDark
                            ? 'text-content-inverse-tertiary hover:text-content-inverse hover:bg-surface-dark-tertiary'
                            : 'text-content-tertiary hover:text-content hover:bg-surface-secondary'
                        }`}
                        title="Close session"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
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
                        className={`p-2 rounded-lg transition-colors ${
                          isDark
                            ? 'text-content-inverse-tertiary hover:text-red-400 hover:bg-red-500/10'
                            : 'text-content-tertiary hover:text-red-600 hover:bg-red-50'
                        }`}
                        title="Delete session permanently"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
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

      {/* Public Link Modal */}
      {project?.isPublic && project?.publicToken && projectId && (
        <PublicLinkModal
          isOpen={isPublicLinkModalOpen}
          onClose={() => setIsPublicLinkModalOpen(false)}
          projectId={projectId}
          projectName={project.name}
          publicToken={project.publicToken}
          isEnabled={project.publicEnabled}
          onStatusChange={(enabled) => {
            // Update local project state to reflect the change
            setProject(prev => prev ? { ...prev, publicEnabled: enabled } : null)
          }}
        />
      )}

      {/* Share Project Modal */}
      {project && projectId && (
        <ShareProjectModal
          isOpen={isShareModalOpen}
          onClose={() => setIsShareModalOpen(false)}
          projectId={projectId}
          projectName={project.name}
          isOwner={project.isOwner ?? true}
        />
      )}
    </div>
  )
}
