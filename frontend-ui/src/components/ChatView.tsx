
import { useEffect, useRef, useMemo, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useParams } from 'react-router-dom'
import { Eye } from 'lucide-react'
import { useStore } from '../store'
import ProcessingMessageView from './ProcessingMessageView'
import ProcessingToggle from './ProcessingToggle'
import ParticipantNotification from './ParticipantNotification'
import type { ListenerStatus } from '../lib/api-types'

interface ChatViewProps {
  listenerStatus?: ListenerStatus | null
  onShowLogs?: () => void
  sessionId?: string
}

export default function ChatView({ listenerStatus, onShowLogs, sessionId: propSessionId }: ChatViewProps) {
  const { sessionId: paramSessionId } = useParams<{ sessionId: string }>()
  const sessionId = propSessionId || paramSessionId
  const turns = useStore(s => s.turns)
  const processingMessages = useStore(s => s.processingMessages)
  const participantEvents = useStore(s => s.participantEvents)
  const showProcessingMessages = useStore(s => s.showProcessingMessages)
  const showTaskPanel = useStore(s => s.showTaskPanel)
  const agentTaskLists = useStore(s => s.agentTaskLists)
  const setShowTaskPanel = useStore(s => s.setShowTaskPanel)
  const setFaceModalOpen = useStore(s => s.setFaceModalOpen)

  // Historical messages from database
  const historicalMessages = useStore(s => s.historicalMessages)
  const loadHistoricalMessages = useStore(s => s.loadHistoricalMessages)
  const loadMoreHistory = useStore(s => s.loadMoreHistory)
  const hasMoreHistory = useStore(s => s.hasMoreHistory)
  const isLoadingHistory = useStore(s => s.isLoadingHistory)
  const clearHistory = useStore(s => s.clearHistory)

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const [isNearBottom, setIsNearBottom] = useState(true)

  // Get task timeline actions
  const buildTaskUpdateTimeline = useStore(s => s.buildTaskUpdateTimeline)
  const applyLatestTaskState = useStore(s => s.applyLatestTaskState)
  const applyTaskStateAtTime = useStore(s => s.applyTaskStateAtTime)
  const setTaskHistoryMode = useStore(s => s.setTaskHistoryMode)
  const taskUpdateHistory = useStore(s => s.taskUpdateHistory)
  const clearTaskTimeline = useStore(s => s.clearTaskTimeline)
  const clearTasks = useStore(s => s.clearTasks)
  const clear = useStore(s => s.clear)

  // Load history on mount
  useEffect(() => {
    if (sessionId) {
      console.log('[ChatView] Loading historical messages for session', sessionId)
      loadHistoricalMessages(sessionId)
    }

    // Cleanup on unmount or session change
    return () => {
      console.log('[ChatView] Unmounting, clearing all state')
      clear()              // Clear live messages (turns, processingMessages, participantEvents)
      clearHistory()       // Clear historical DB messages
      clearTaskTimeline()  // Clear task timeline
      clearTasks()         // Clear agent task lists
    }
  }, [sessionId, loadHistoricalMessages, clear, clearHistory, clearTaskTimeline, clearTasks])

  // Build task timeline and apply latest state when historical messages load
  useEffect(() => {
    if (historicalMessages.length > 0) {
      console.log('[ChatView] Building task timeline from', historicalMessages.length, 'messages')
      buildTaskUpdateTimeline(historicalMessages)
      applyLatestTaskState()
    }
  }, [historicalMessages, buildTaskUpdateTimeline, applyLatestTaskState])

  // Convert historical DB messages to display format and merge with real-time messages
  const allMessages = useMemo(() => {
    // Helper to extract participant name from various sources
    // Priority: envelope.participant_id (logical sender) > display_name > LiveKit participant info > role
    const getParticipantName = (msg: any) => {
      return msg.metadata?.envelope?.participant_id  // Logical sender from message envelope
        || msg.metadata?.display_name                // Stored display name (fallback)
        || msg.metadata?.participant_name             // LiveKit participant name
        || msg.metadata?.participant_identity         // LiveKit participant identity
        || msg.participant?.name                      // Legacy participant name
        || msg.participant?.identity                  // Legacy participant identity
        || msg.role                                   // Last resort: use role
    }

    // Helper to map server message type to frontend processing type
    const mapToProcessingType = (serverType: string): 'decision' | 'prompt_execution' | 'expert_status' | 'safety_check' => {
      switch (serverType) {
        case 'decision_stream': return 'decision'
        case 'expert_status': return 'expert_status'
        case 'expert_results': return 'expert_status'
        case 'prompt_execution': return 'prompt_execution'
        case 'safety_check': return 'safety_check'
        default: return 'decision'
      }
    }

    // Convert historical messages to display format
    // New approach: Parse from metadata.envelope for perfect replay
    const historical = historicalMessages.map(msg => {
      const timestamp = new Date(msg.timestamp).getTime()

      // Extract the complete envelope from metadata (new storage format)
      const envelope = msg.metadata?.envelope

      if (!envelope) {
        // Fallback for old messages without envelope - use legacy parsing
        // This ensures backward compatibility with messages stored before the refactor
        return {
          id: msg.id,
          text: msg.content,
          role: (msg.role || 'system') as 'user' | 'assistant' | 'system',
          status: 'final' as const,
          startedAt: timestamp,
          messageType: 'transcript' as const,
          participant_id: getParticipantName(msg),
          source: 'db' as const,
        }
      }

      // Parse based on envelope.type (same logic as live messages)
      const messageType = envelope.type || 'unknown'
      const messageData = envelope.data || envelope

      // Handle different message types
      if (messageType === 'transcript_chunk') {
        // Transcript messages
        return {
          id: msg.id,
          text: typeof messageData === 'string' ? messageData : messageData.text,
          role: msg.role as 'user' | 'assistant' | 'system',
          status: 'final' as const,
          startedAt: timestamp,
          finalizedAt: timestamp,
          messageType: 'transcript' as const,
          participant_id: getParticipantName(msg),
          source: 'db' as const,
        }
      } else if (['decision_stream', 'expert_status', 'expert_results', 'prompt_execution', 'safety_check'].includes(messageType)) {
        // Processing messages
        const processingType = mapToProcessingType(messageType)
        return {
          id: msg.id,
          type: processingType,
          role: 'system' as const,
          status: 'final' as const,
          startedAt: timestamp,
          finalizedAt: timestamp,
          streamId: messageData.stream_id || 'db-stream',
          data: messageData,
          messageType: 'processing' as const,
          source: 'db' as const,
        }
      } else if (['complete_todo_list', 'plan_progress_update', 'plan_deliverable_update', 'state_change_notification'].includes(messageType)) {
        // Task update messages - don't display in chat (handled by task panel)
        return null
      } else if (['voice_narration_control', 'barge_in', 'tts_pause', 'tts_resume', 'tts_start', 'tts_stop'].includes(messageType)) {
        // Control messages - don't display in chat
        return null
      } else if (messageType.startsWith('audio_stream_')) {
        // Audio streaming messages - don't display in chat
        return null
      } else {
        // Unknown message type - display as simple transcript with content
        return {
          id: msg.id,
          text: typeof messageData === 'string' ? messageData : JSON.stringify(messageData),
          role: (msg.role || 'system') as 'user' | 'assistant' | 'system',
          status: 'final' as const,
          startedAt: timestamp,
          messageType: 'transcript' as const,
          participant_id: getParticipantName(msg),
          source: 'db' as const,
        }
      }
    }).filter((msg): msg is NonNullable<typeof msg> => msg !== null) // Remove nulls with type guard

    // Combine with live messages
    const liveTranscripts = turns.map(t => ({ ...t, messageType: 'transcript' as const, source: 'live' as const }))
    const processing = showProcessingMessages
      ? processingMessages.map(p => ({ ...p, messageType: 'processing' as const, source: 'live' as const }))
      : []
    const events = participantEvents.map(e => ({ ...e, source: 'live' as const }))

    const combined = [...historical, ...liveTranscripts, ...processing, ...events]

    // Deduplicate by ID (prefer live version if exists)
    const unique = Array.from(
      new Map(combined.map(m => [m.id, m])).values()
    )

    return unique.sort((a, b) => a.startedAt - b.startedAt)
  }, [historicalMessages, turns, processingMessages, participantEvents, showProcessingMessages])

  // Infinite scroll handler with time-travel support
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget
    const scrollTop = target.scrollTop
    const scrollHeight = target.scrollHeight
    const clientHeight = target.clientHeight

    // Check if near bottom (within 100px)
    const nearBottom = scrollHeight - scrollTop - clientHeight < 100
    setIsNearBottom(nearBottom)

    // Time travel: Apply task state based on scroll position
    if (taskUpdateHistory.length > 0 && allMessages.length > 0) {
      if (nearBottom) {
        // At bottom - show latest state (exit history mode)
        applyLatestTaskState()
        setTaskHistoryMode(false, null)
      } else {
        // Not at bottom - calculate estimated timestamp from scroll position
        const oldestMessage = allMessages[0]
        const newestMessage = allMessages[allMessages.length - 1]
        const timeRange = newestMessage.startedAt - oldestMessage.startedAt

        // Calculate scroll percentage (0 = top/oldest, 1 = bottom/newest)
        const scrollPercentage = (scrollTop + clientHeight) / scrollHeight

        // Estimate current timestamp based on scroll position
        const estimatedTime = oldestMessage.startedAt + (timeRange * scrollPercentage)

        // Apply task state at this time (throttled - only if significantly different)
        const currentHistoricalTimestamp = useStore.getState().currentHistoricalTimestamp
        if (!currentHistoricalTimestamp || Math.abs(estimatedTime - currentHistoricalTimestamp) > 5000) {
          applyTaskStateAtTime(estimatedTime)
        }
      }
    }

    // Load more when scrolling near top
    if (scrollTop < 100 && hasMoreHistory && !isLoadingHistory && sessionId) {
      // Save current scroll position
      const previousScrollHeight = scrollHeight

      loadMoreHistory(sessionId).then(() => {
        // Restore scroll position after loading (prevents jump)
        requestAnimationFrame(() => {
          if (scrollContainerRef.current) {
            const newScrollHeight = scrollContainerRef.current.scrollHeight
            scrollContainerRef.current.scrollTop = newScrollHeight - previousScrollHeight + scrollTop
          }
        })
      })
    }
  }, [hasMoreHistory, isLoadingHistory, loadMoreHistory, sessionId, taskUpdateHistory, allMessages, applyLatestTaskState, applyTaskStateAtTime, setTaskHistoryMode])

  // Auto-scroll to bottom for new messages (only if already at bottom)
  useEffect(() => {
    if (isNearBottom && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [allMessages, isNearBottom])

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header with processing toggle and task panel toggle */}
      <motion.div
        className="px-4 py-3 border-b border-neutral-200/40 backdrop-blur-sm"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ProcessingToggle />

            {/* Recording Indicator - Clickable Button */}
            {(() => {
              const isRecording = listenerStatus?.listener?.isConnected
              const isReconnecting = listenerStatus?.listener?.roomState === 'reconnecting'

              return (
                <button
                  onClick={onShowLogs}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-neutral-50/60 border border-neutral-200/60 hover:bg-neutral-100/80 hover:border-neutral-300/80 transition-all duration-200 cursor-pointer"
                  title={
                    isRecording
                      ? 'Recording active - Click to view logs'
                      : isReconnecting
                        ? 'Reconnecting to recorder - Click to view logs'
                        : 'Not recording - Click to view logs'
                  }
                >
                  <div
                    className={`w-2 h-2 rounded-full transition-all duration-300 ${
                      isRecording
                        ? 'bg-red-500 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.6)]'
                        : isReconnecting
                          ? 'bg-yellow-500 animate-pulse shadow-[0_0_8px_rgba(234,179,8,0.6)]'
                          : 'bg-neutral-300'
                    }`}
                  />
                  <span className="text-[10px] text-neutral-600 font-light tracking-wider uppercase">
                    {isRecording ? 'RECORDING' : isReconnecting ? 'RECONNECTING' : 'IDLE'}
                  </span>
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    className="text-neutral-400"
                  >
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                  </svg>
                </button>
              )
            })()}

            {/* Face Button */}
            <button
              onClick={() => setFaceModalOpen(true)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-neutral-50/60 border border-neutral-200/60 hover:bg-neutral-100/80 hover:border-neutral-300/80 transition-all duration-200 cursor-pointer"
              title="Show GRACE face interface"
            >
              <Eye className="w-3 h-3 text-neutral-400" />
              <span className="text-[10px] text-neutral-600 font-light tracking-wider uppercase">
                FACE
              </span>
            </button>
          </div>

          {/* Task Panel Toggle Button - only show when panel is hidden and agent tasks exist */}
          {!showTaskPanel && agentTaskLists.size > 0 && (
            <motion.button
              onClick={() => setShowTaskPanel(true)}
              className="
                flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs
                bg-neutral-100/60 text-neutral-600 border border-neutral-200/60
                hover:bg-neutral-200/60 hover:text-neutral-700
                transition-all duration-200 font-light tracking-wide
              "
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3 }}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
              </svg>
              Show Tasks
            </motion.button>
          )}
        </div>
      </motion.div>

      {/* Messages */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-auto p-4 space-y-2"
        onScroll={handleScroll}
      >
        {/* Loading indicator at top - only show when there are existing messages */}
        {isLoadingHistory && historicalMessages.length > 0 && (
          <div className="text-center text-sm text-neutral-400 py-2 mb-2">
            <div className="inline-flex items-center gap-2">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Loading older messages...
            </div>
          </div>
        )}

        <AnimatePresence initial={false}>
          {allMessages.map((message, index) => {
            // Only animate container for non-transcript messages (processing messages, etc.)
            const shouldAnimate = message.messageType !== 'transcript'

            const messageContent = (
              <>
                {message.messageType === 'transcript' ? (
                  message.role === 'system' ? (
                    // System messages - centered notification
                    <motion.div className="flex justify-center my-4">
                      <div className="px-4 py-2 bg-neutral-100/60 text-neutral-600 border border-neutral-200/60 rounded-full text-xs font-light tracking-wide">
                        {message.text}
                      </div>
                    </motion.div>
                  ) : (
                <motion.div
                  className={`max-w-[75%] relative group ${message.role === 'user' ? 'ml-auto' : 'mr-auto'
                    }`}
                >
                  {/* Message Bubble */}
                  <div className={`
                    px-4 py-3 backdrop-blur-sm border
                    ${message.role === 'user'
                      ? message.status === 'partial'
                        ? 'bg-neutral-900/95 text-white border-neutral-800/40 rounded-[16px] opacity-85'  // User partial
                        : 'bg-neutral-900 text-white border-neutral-800/60 rounded-[16px] shadow-[0_1px_30px_rgba(0,0,0,0.12)]'  // User final
                      : message.role === 'assistant'
                        ? 'bg-white/95 text-neutral-900 border-neutral-200/80 rounded-[16px] shadow-[0_1px_30px_rgba(0,0,0,0.04)]'  // Assistant
                        : 'bg-neutral-50/90 text-neutral-700 border-neutral-300/60 rounded-[14px]'  // Other
                    }
                  `}>
                    {/* Message Header */}
                    <motion.div
                      className={`text-[10px] mb-2 flex items-center gap-2 tracking-wider uppercase font-light ${message.role === 'user' ? 'text-neutral-200' : 'text-neutral-600'
                        }`}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 0.6 }}
                      transition={{ delay: 0.1, duration: 0.3 }}
                    >
                      <span>{message.participant_id || message.role}</span>
                      <span className="opacity-50">•</span>
                      <span>
                        {new Date(message.startedAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </span>
                    </motion.div>

                    {/* Message Content */}
                    {message.status === 'partial' ? (
                      // No animation for partial messages to prevent weird text appearance
                      <div
                        className="font-light leading-relaxed text-[15px] opacity-85"
                      >
                        {message.text}
                        <motion.span
                          className="font-thin ml-1 text-neutral-400"
                          animate={{ opacity: [0, 1, 0] }}
                          transition={{ duration: 1.2, repeat: Infinity }}
                        >
                          |
                        </motion.span>
                      </div>
                    ) : (
                      // Final messages - no animations
                      <div className="font-light leading-relaxed text-[15px]">
                        {message.text}
                      </div>
                    )}
                  </div>

                  {/* Minimal shadow for user messages */}
                  {message.role === 'user' && message.status === 'final' && (
                    <motion.div
                      className="absolute inset-0 rounded-[16px] bg-neutral-900/5 -z-10 blur-sm"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.3, duration: 0.4 }}
                    />
                  )}
                </motion.div>
                  )
              ) : message.messageType === 'participant' ? (
                <ParticipantNotification event={message} />
              ) : (
                <motion.div
                  // initial={{ opacity: 0, scale: 0.9 }}
                  // animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.3, delay: 0.1 }}
                >
                  <ProcessingMessageView message={message} />
                </motion.div>
              )}
              </>
            )

            return shouldAnimate ? (
              <motion.div
                key={message.id}
                initial={{ opacity: 0, y: 20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -20, scale: 0.95 }}
                transition={{
                  duration: 0.4,
                  delay: index * 0.02,
                  ease: [0.25, 0.46, 0.45, 0.94]
                }}
              >
                {messageContent}
              </motion.div>
            ) : (
              <div key={message.id}>
                {messageContent}
              </div>
            )
          })}
        </AnimatePresence>
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
