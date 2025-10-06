import { useEffect, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import ConnectPanel from '../components/ConnectPanel'
import ChatView from '../components/ChatView'
import Composer from '../components/Composer'
import TaskPanel from '../components/TaskPanel'
import AgentSidebar from '../components/agents/AgentSidebar'
import ParticipantSection from '../components/participants/ParticipantSection'
import EditSessionModal from '../components/modals/EditSessionModal'
import RegisterParticipantModal from '../components/modals/RegisterParticipantModal'
import ParticipantConnectionModal from '../components/modals/ParticipantConnectionModal'
import DeployAgentModal from '../components/modals/DeployAgentModal'
import ConfirmDialog from '../components/modals/ConfirmDialog'
import MonitorLogsModal from '../components/modals/MonitorLogsModal'
import NetworkInfoModal from '../components/modals/NetworkInfoModal'
import { useStore } from '../store'
import { useAuthStore } from '../store/authStore'
import { apiClient } from '../services/ApiClient'
import { useToastStore } from '../store/toastStore'
import type { SessionDetail, Participant, ListenerStatus } from '../lib/api-types'

export default function SessionView() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()
  const { addToast } = useToastStore()

  const [session, setSession] = useState<SessionDetail | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)

  // Participant modal states
  const [isRegisterModalOpen, setIsRegisterModalOpen] = useState(false)
  const [selectedParticipantId, setSelectedParticipantId] = useState<string | null>(null)
  const [participants, setParticipants] = useState<Participant[]>([])
  const [participantConfirmDialog, setParticipantConfirmDialog] = useState<{
    isOpen: boolean
    title: string
    message: string
    onConfirm: () => void
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  })

  // Agent modal states
  const [isDeployModalOpen, setIsDeployModalOpen] = useState(false)

  // Network info modal state
  const [isNetworkInfoOpen, setIsNetworkInfoOpen] = useState(false)

  // Listener status for recording indicator
  const [listenerStatus, setListenerStatus] = useState<ListenerStatus | null>(null)
  const [showLogsModal, setShowLogsModal] = useState(false)

  const transport = useStore(s => s.transport)
  const status = useStore(s => s.status)
  const setStatus = useStore(s => s.setStatus)
  const user = useAuthStore(s => s.user)
  const showTaskPanel = useStore(s => s.showTaskPanel)
  const addLiveTaskUpdate = useStore(s => s.addLiveTaskUpdate)
  const setTodoList = useStore(s => s.setTodoList)
  const updateDeliverable = useStore(s => s.updateDeliverable)
  const setProgress = useStore(s => s.setProgress)
  const handleStateChange = useStore(s => s.handleStateChange)
  const setAllDeliverableStates = useStore(s => s.setAllDeliverableStates)
  const setProcessingMode = useStore(s => s.setProcessingMode)
  const addNotification = useStore(s => s.addNotification)

  // Load session details
  useEffect(() => {
    const loadSession = async () => {
      if (!sessionId) return

      try {
        setIsLoading(true)
        setError(null)
        const data = await apiClient.getSession(sessionId)
        setSession(data)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load session')
      } finally {
        setIsLoading(false)
      }
    }

    loadSession()
  }, [sessionId])

  // Set user name on transport when available
  useEffect(() => {
    if (user?.name) {
      transport.setUserName(user.name)
      console.log(`[SessionView] Set user name on transport: ${user.name}`)
    }
  }, [user, transport])

  // Connect transport callbacks for task updates - MUST happen BEFORE auto-connect
  useEffect(() => {
    const handleTodoListUpdate = (data: any) => {
      try {
        // Validate required fields for state machine
        if (!data.todo_list || !data.conversation_id) {
          console.warn('Invalid state machine data received:', data)
          return
        }

        if (!data.todo_list.states || !Array.isArray(data.todo_list.states)) {
          console.warn('Invalid states array in todo list data:', data)
          return
        }

        // Validate current_state if it exists
        if (data.todo_list.current_state && !data.todo_list.current_state.title) {
          console.warn('Current state missing title:', data.todo_list.current_state)
        }

        // Extract agent identifier from message
        const agentId = data.participant_id || 'default-agent'

        // Try to find agent info from session agents
        const agent = session?.agents?.find(a => a.podName === agentId || a.id === agentId)
        const agentName = agent?.name || data.participant_id
        const agentIcon = agent?.icon || '🤖'

        console.log(`📋 [TASK] Todo list update received:`, {
          trigger: data.update_trigger,
          agentId,
          agentName,
          agentIcon,
          states: data.todo_list.states?.length || 0,
          current_state: data.todo_list.current_state?.title || 'none',
          processing_mode: data.context?.current_processing_mode,
        })

        // Add agent icon to todo list data
        const todoListWithAgent = {
          ...data.todo_list,
          agentIcon
        }

        // Route to multi-agent system with timeline tracking for live updates
        addLiveTaskUpdate(agentId, todoListWithAgent, agentName)

        // Keep legacy support for backward compatibility
        setTodoList(data.todo_list)

        if (data.all_deliverable_states) {
          setAllDeliverableStates(data.all_deliverable_states)
        }

        if (data.context?.current_processing_mode) {
          setProcessingMode(data.context.current_processing_mode)
        }
      } catch (error) {
        console.error('Error handling state machine update:', error)
      }
    }

    const handlePlanProgress = (data: any) => {
      console.log(`📊 [TASK] Plan progress update:`, {
        percentage: data.progress.percentage,
        state: data.current_state?.title,
        mode: data.current_state?.type,
      })
      setProgress(data.progress.percentage)
    }

    const handleDeliverableUpdate = (data: any) => {
      console.log(`📦 [DELIVERABLE] ${data.deliverable_key}: ${data.deliverable_value}`)
      if (data.reasoning) {
        console.log(`   Reasoning: ${data.reasoning}`)
      }

      updateDeliverable(
        data.deliverable_key,
        data.deliverable_value,
        data.state_id,
        data.confidence,
        data.source_message,
        data.reasoning,
        data.acceptance_criteria
      )

      const confidencePercent = data.confidence ? Math.round(data.confidence * 100) : 100
      addNotification({
        type: 'deliverable_collected',
        title: `Collected: ${data.deliverable_key.replace(/_/g, ' ').replace(/\b\w/g, (l: any) => l.toUpperCase())}`,
        message: `Value: ${data.deliverable_value} (${confidencePercent}% confidence)`,
        importance: 'medium',
        data: {
          key: data.deliverable_key,
          value: data.deliverable_value,
          confidence: data.confidence,
          reasoning: data.reasoning,
          stateId: data.state_id,
          acceptanceCriteria: data.acceptance_criteria,
        },
      })
    }

    const handleStateMachineStateChange = (data: any) => {
      handleStateChange(data)
    }

    // Wire up the callbacks IMMEDIATELY when component mounts
    console.log('[SessionView] Setting up transport callbacks')
    transport.onTodoListUpdate = handleTodoListUpdate
    transport.onPlanProgress = handlePlanProgress
    transport.onDeliverableUpdate = handleDeliverableUpdate
    transport.onStateChange = handleStateMachineStateChange

    return () => {
      // Cleanup callbacks
      transport.onTodoListUpdate = () => {}
      transport.onPlanProgress = () => {}
      transport.onDeliverableUpdate = () => {}
      transport.onStateChange = () => {}
    }
  }, [
    transport,
    session,
    addLiveTaskUpdate,
    setTodoList,
    updateDeliverable,
    setProgress,
    handleStateChange,
    setAllDeliverableStates,
    setProcessingMode,
    addNotification,
  ])

  // Auto-connect to LiveKit room on mount, disconnect on unmount
  // This runs AFTER callbacks are set up (effect order matters)
  useEffect(() => {
    const autoConnect = async () => {
      if (!session?.room?.livekitRoomName) return

      try {
        // Only auto-connect if we're in idle or error state
        // Don't interfere if already connecting or connected
        if (status === 'idle' || status === 'error') {
          console.log('[SessionView] Auto-connecting to LiveKit room:', session.room.livekitRoomName)
          setStatus('connecting')
          await transport.connect(session.room.livekitRoomName)
        }
      } catch (error) {
        console.error('[SessionView] Auto-connect failed:', error)
        setStatus('error')
      }
    }

    autoConnect()

    // Disconnect when component unmounts or session changes
    return () => {
      // Disconnect regardless of status to ensure cleanup
      console.log('[SessionView] Auto-disconnecting from LiveKit room')
      transport.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.room?.livekitRoomName])

  // Handle session name update
  const handleUpdateSessionName = async (name: string | null) => {
    if (!sessionId) return

    try {
      const updatedSession = await apiClient.updateSession(sessionId, { name: name || undefined })
      setSession(updatedSession)
      addToast({
        message: name ? `Session renamed to "${name}"` : 'Session name cleared',
        type: 'success'
      })
    } catch (err) {
      addToast({
        message: err instanceof Error ? err.message : 'Failed to update session name',
        type: 'error'
      })
      throw err
    }
  }

  // Load participants
  const loadParticipants = async () => {
    if (!sessionId) return
    try {
      const data = await apiClient.listParticipants(sessionId)
      setParticipants(data)
    } catch (err) {
      console.error('Failed to load participants:', err)
    }
  }

  // Register new participant
  const handleRegisterParticipant = async (name: string) => {
    if (!sessionId) return

    try {
      const response = await apiClient.registerParticipant(sessionId, name)

      // Convert RegisterParticipantResponse to Participant
      const newParticipant: Participant = {
        id: response.id,
        sessionId,
        name: response.name,
        identity: response.identity,
        joinedAt: new Date().toISOString(),
        leftAt: null
      }

      setParticipants(prev => [...prev, newParticipant])

      // Show connection modal with the new participant
      setSelectedParticipantId(newParticipant.id)

      addToast({ message: 'Participant registered successfully', type: 'success' })
    } catch (err) {
      addToast({
        message: err instanceof Error ? err.message : 'Failed to register participant',
        type: 'error'
      })
    }
  }

  // Remove participant
  const handleRemoveParticipant = (participantId: string, participantName: string) => {
    setParticipantConfirmDialog({
      isOpen: true,
      title: 'Remove Participant',
      message: `Are you sure you want to remove "${participantName}"? This will disconnect them from the session.`,
      onConfirm: async () => {
        setParticipantConfirmDialog(prev => ({ ...prev, isOpen: false }))
        try {
          await apiClient.removeParticipant(participantId)
          setParticipants(prev => prev.filter(p => p.id !== participantId))
          addToast({ message: 'Participant removed successfully', type: 'success' })
        } catch (err) {
          addToast({
            message: err instanceof Error ? err.message : 'Failed to remove participant',
            type: 'error'
          })
        }
      },
    })
  }

  // Deploy agent
  const handleDeployAgent = async (name: string, icon?: string, planId?: string) => {
    if (!sessionId) return

    try {
      await apiClient.createAgent(sessionId, { name, icon, planId })
      addToast({ message: 'Agent deployed successfully', type: 'success' })

      // Refresh session to get updated agents list
      const updatedSession = await apiClient.getSession(sessionId)
      setSession(updatedSession)
    } catch (err) {
      addToast({
        message: err instanceof Error ? err.message : 'Failed to deploy agent',
        type: 'error'
      })
      throw err
    }
  }

  // Load participants on mount
  useEffect(() => {
    loadParticipants()
  }, [sessionId])

  // Poll listener status every 2 seconds
  useEffect(() => {
    if (!sessionId || !session || session.status !== 'ACTIVE') return

    const pollStatus = async () => {
      try {
        const status = await apiClient.getListenerStatus(sessionId)
        setListenerStatus(status)
      } catch (err) {
        console.error('Failed to get listener status:', err)
      }
    }

    // Initial poll
    pollStatus()

    // Poll every 2 seconds
    const interval = setInterval(pollStatus, 2000)

    return () => clearInterval(interval)
  }, [sessionId, session?.status])

  if (!sessionId) {
    return <div>Invalid session ID</div>
  }

  if (isLoading) {
    return (
      <div className="w-full h-screen flex items-center justify-center bg-neutral-50">
        <div className="text-sm text-neutral-400 font-light">Loading session...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="w-full h-screen flex items-center justify-center bg-neutral-50">
        <div className="text-center">
          <div className="text-red-600 text-sm font-light mb-4">{error}</div>
          <button
            onClick={() => navigate('/dashboard')}
            className="px-4 py-2 rounded-lg bg-neutral-900 text-white text-sm font-light"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full h-screen bg-neutral-50">
      {/* Header */}
      <header className="bg-white/90 backdrop-blur-xl border-b border-neutral-200/60 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 py-3">
          <div className="flex items-center gap-3">
            {/* Back Button - vertically centered */}
            <Link
              to={`/project/${session?.projectId}`}
              className="
                p-1.5 rounded-lg self-center
                text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100
                transition-all duration-200
              "
              title="Back to sessions"
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
            <div className="flex-1">
              {/* Breadcrumb */}
              <div className="flex items-center gap-2 text-xs text-neutral-500 font-light mb-1">
                <Link
                  to="/dashboard"
                  className="hover:text-neutral-900 transition-colors duration-200"
                >
                  Projects
                </Link>
                <span>/</span>
                <Link
                  to={`/project/${session?.projectId}`}
                  className="hover:text-neutral-900 transition-colors duration-200"
                >
                  Sessions
                </Link>
                <span>/</span>
                <span className="text-neutral-900 font-mono text-[10px]">
                  {session?.room.livekitRoomName || 'Session'}
                </span>
              </div>

              {/* Title - Editable */}
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-light text-neutral-900 tracking-wide">
                  {session?.name || session?.room.livekitRoomName || 'Session'}
                </h1>
                <button
                  onClick={() => setIsEditModalOpen(true)}
                  className="
                    p-1.5 rounded-lg
                    text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100
                    transition-all duration-200
                  "
                  title="Edit session name"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  >
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>
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

      <div className="h-[calc(100vh-80px)] flex gap-4 p-4 text-neutral-900">
        {/* Left Sidebar - Participants and Agents */}
        <div className="flex-shrink-0 space-y-4">
          <ParticipantSection
            sessionId={sessionId}
            participants={participants}
            onRegisterClick={() => setIsRegisterModalOpen(true)}
            onShowConnectionInfo={setSelectedParticipantId}
            onRemoveParticipant={handleRemoveParticipant}
          />
          <AgentSidebar
            sessionId={sessionId}
            initialAgents={session?.agents}
            onDeployClick={() => setIsDeployModalOpen(true)}
          />
        </div>

        {/* Main Content Area */}
        <div className={`flex flex-col gap-3 transition-all duration-300 ${showTaskPanel ? 'flex-1' : 'w-full max-w-3xl mx-auto'}`}>
          <ConnectPanel roomName={session?.room.livekitRoomName} />

          <div className="flex-1 bg-white/90 backdrop-blur-xl rounded-xl shadow-sm border border-neutral-200/60 flex flex-col overflow-hidden">
            <ChatView
              listenerStatus={listenerStatus}
              onShowLogs={() => setShowLogsModal(true)}
              sessionId={sessionId}
            />
          </div>

          <Composer />
        </div>

        {/* Task Panel - Now displays multiple agent cards side-by-side */}
        {showTaskPanel && (
          <div className="flex-shrink-0">
            <TaskPanel />
          </div>
        )}
      </div>

      {/* Modals - All rendered at root level to avoid z-index issues */}
      {session && (
        <EditSessionModal
          isOpen={isEditModalOpen}
          onClose={() => setIsEditModalOpen(false)}
          onSubmit={handleUpdateSessionName}
          currentName={session.name}
          sessionId={session.id}
        />
      )}

      <RegisterParticipantModal
        isOpen={isRegisterModalOpen}
        onClose={() => setIsRegisterModalOpen(false)}
        onSubmit={handleRegisterParticipant}
      />

      {selectedParticipantId && (
        <ParticipantConnectionModal
          participantId={selectedParticipantId}
          onClose={() => setSelectedParticipantId(null)}
        />
      )}

      <DeployAgentModal
        isOpen={isDeployModalOpen}
        onClose={() => setIsDeployModalOpen(false)}
        onSubmit={handleDeployAgent}
      />

      <ConfirmDialog
        isOpen={participantConfirmDialog.isOpen}
        title={participantConfirmDialog.title}
        message={participantConfirmDialog.message}
        confirmText="Remove"
        confirmVariant="danger"
        onConfirm={participantConfirmDialog.onConfirm}
        onCancel={() => setParticipantConfirmDialog(prev => ({ ...prev, isOpen: false }))}
      />

      {/* Monitor Logs Modal */}
      <MonitorLogsModal
        isOpen={showLogsModal}
        onClose={() => setShowLogsModal(false)}
        sessionId={sessionId}
      />

      {/* Network Info Modal */}
      <NetworkInfoModal
        isOpen={isNetworkInfoOpen}
        onClose={() => setIsNetworkInfoOpen(false)}
      />
    </div>
  )
}
