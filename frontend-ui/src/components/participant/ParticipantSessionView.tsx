import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Mic,
  MicOff,
  MessageSquare,
  X,
  LayoutGrid,
  Maximize2,
  Minimize2,
  Subtitles,
  Loader2,
} from 'lucide-react'
import { Room, RoomEvent, Track, RemoteTrack, RemoteTrackPublication, RemoteParticipant, LocalTrackPublication } from 'livekit-client'
import TranscriptOverlay from '../face/TranscriptOverlay'
import VisualizerGallery from '../face/VisualizerGallery'
import VisualizerRenderer from '../face/VisualizerRenderer'
import ParticipantChatPanel from './ParticipantChatPanel'
import { VisualizerType } from '../face/types'
import { apiClient } from '../../services/ApiClient'
import type { DeliveryStatus } from '../../lib/types'

// Message type for participant chat - extends basic message with delivery tracking
export type ParticipantMessageType = 'message' | 'participant_event'

export interface ParticipantMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  timestamp: Date
  messageType?: ParticipantMessageType
  eventType?: 'joined' | 'left'  // For participant_event messages
  participantName?: string  // For participant_event messages
  deliveryStatus?: DeliveryStatus
  correlationId?: string
}

interface ConnectionInfo {
  token: string
  serverUrl: string
  roomName: string
}

interface SessionData {
  participantId: string
  participantName: string
  identity: string
  sessionId: string
  authToken: string  // Participant JWT for API calls
  connectionInfo: ConnectionInfo
  visualizerType: string | null
  visualizerLocked: boolean
}

interface ParticipantSessionViewProps {
  sessionData: SessionData
}

export default function ParticipantSessionView({ sessionData }: ParticipantSessionViewProps) {
  // Room connection state
  const [room, setRoom] = useState<Room | null>(null)
  const [isConnecting, setIsConnecting] = useState(true)
  const [connectionError, setConnectionError] = useState<string | null>(null)

  // Audio state
  const [isMuted, setIsMuted] = useState(true)
  const [audioLevel, setAudioLevel] = useState(0)
  const [isRemoteSpeaking, setIsRemoteSpeaking] = useState(false)

  // UI state
  const [currentVisualizer, setCurrentVisualizer] = useState<VisualizerType>(
    (sessionData.visualizerType as VisualizerType) || 'face'
  )
  const [isGalleryOpen, setIsGalleryOpen] = useState(false)
  const [isChatOpen, setIsChatOpen] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [showSubtitles, setShowSubtitles] = useState(true)
  const [showControls, setShowControls] = useState(true)

  // Transcripts
  const [userTranscript, setUserTranscript] = useState('')
  const [messages, setMessages] = useState<ParticipantMessage[]>([])
  const [pendingCorrelationIds, setPendingCorrelationIds] = useState<Set<string>>(new Set())
  const [isLoadingHistory, setIsLoadingHistory] = useState(false)
  const [historyLoaded, setHistoryLoaded] = useState(false)

  // Refs
  const containerRef = useRef<HTMLDivElement>(null)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const publishedAudioTrackRef = useRef<LocalTrackPublication | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)

  // Connect to LiveKit room
  useEffect(() => {
    const connectToRoom = async () => {
      try {
        setIsConnecting(true)
        setConnectionError(null)

        const newRoom = new Room({
          adaptiveStream: true,
          dynacast: true,
        })

        // Set up event listeners
        newRoom.on(RoomEvent.TrackSubscribed, handleTrackSubscribed)
        newRoom.on(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed)
        newRoom.on(RoomEvent.DataReceived, handleDataReceived)
        newRoom.on(RoomEvent.Disconnected, handleDisconnected)
        newRoom.on(RoomEvent.ParticipantConnected, handleParticipantConnected)
        newRoom.on(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected)

        await newRoom.connect(
          sessionData.connectionInfo.serverUrl,
          sessionData.connectionInfo.token
        )

        setRoom(newRoom)
        setIsConnecting(false)
      } catch (error: any) {
        console.error('Failed to connect to room:', error)
        setConnectionError(error.message || 'Failed to connect to session')
        setIsConnecting(false)
      }
    }

    connectToRoom()

    return () => {
      if (room) {
        room.disconnect()
      }
      cleanupAudio()
    }
  }, [sessionData.connectionInfo])

  // Heartbeat to maintain presence status
  useEffect(() => {
    const HEARTBEAT_INTERVAL = 15000 // 15 seconds

    // Send initial heartbeat
    const sendHeartbeat = async () => {
      try {
        await apiClient.participantHeartbeat(sessionData.authToken)
      } catch (error) {
        console.error('Heartbeat failed:', error)
      }
    }

    // Send immediately on mount
    sendHeartbeat()

    // Set up interval
    const intervalId = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL)

    return () => {
      clearInterval(intervalId)
    }
  }, [sessionData.authToken])

  // Load message history when chat is opened (or on rejoin)
  const loadMessageHistory = useCallback(async () => {
    if (historyLoaded || isLoadingHistory) return

    try {
      setIsLoadingHistory(true)
      const response = await apiClient.getParticipantMessages(
        sessionData.sessionId,
        sessionData.authToken,
        { limit: 50 }
      )

      // Convert API messages to ParticipantMessage format
      const historyMessages: ParticipantMessage[] = response.messages.map(msg => {
        // Handle participant join/leave events
        // Backend stores as 'participant_joined', 'participant_left', or 'participant_event'
        const msgType = msg.messageType as string  // Cast to string for flexible comparison
        const isParticipantEvent = msgType?.startsWith('participant_')
        if (isParticipantEvent) {
          const metadata = msg.metadata || {}
          // Check metadata.eventType first, then messageType suffix, then content
          const isJoined = metadata.eventType === 'joined' ||
                          msgType === 'participant_joined' ||
                          msg.content?.includes('joined')
          return {
            id: msg.id,
            role: 'system' as const,
            text: msg.content,
            timestamp: new Date(msg.createdAt),
            messageType: 'participant_event' as const,
            eventType: isJoined ? 'joined' as const : 'left' as const,
            participantName: metadata.participantName || msg.participant?.name,
          }
        }

        // Regular message (transcript)
        return {
          id: msg.id,
          role: (msg.role || 'user') as 'user' | 'assistant',
          text: msg.content,
          timestamp: new Date(msg.createdAt),
          messageType: 'message' as const,
          deliveryStatus: 'confirmed' as const, // History messages are always confirmed
        }
      })

      // Prepend history (oldest first) to existing messages, avoiding duplicates
      setMessages(prev => {
        const existingIds = new Set(prev.map(m => m.id))
        const newMessages = historyMessages.filter(m => !existingIds.has(m.id))
        return [...newMessages, ...prev]
      })

      setHistoryLoaded(true)
    } catch (error) {
      console.error('[Participant] Failed to load message history:', error)
    } finally {
      setIsLoadingHistory(false)
    }
  }, [sessionData.sessionId, sessionData.authToken, historyLoaded, isLoadingHistory])

  // Load message history when chat is opened
  useEffect(() => {
    if (isChatOpen && !historyLoaded) {
      loadMessageHistory()
    }
  }, [isChatOpen, historyLoaded, loadMessageHistory])

  // Ref to store the remote audio track for analysis
  const remoteAudioTrackRef = useRef<RemoteTrack | null>(null)
  const audioAnalysisFrameRef = useRef<number | null>(null)

  // Handle track subscribed (for receiving agent audio)
  const handleTrackSubscribed = useCallback(
    (track: RemoteTrack, publication: RemoteTrackPublication) => {
      if (track.kind === Track.Kind.Audio) {
        const audioElement = track.attach()
        audioElement.autoplay = true
        audioElement.volume = 1.0
        audioElement.muted = false

        // Add to DOM (required by some browsers)
        audioElement.style.display = 'none'
        document.body.appendChild(audioElement)

        audioElement.play().catch(err => {
          console.error('[Participant] Audio play failed:', err)
        })

        // Store track reference for audio analysis
        remoteAudioTrackRef.current = track

        // Set up Web Audio API for accurate speech detection
        setupRemoteAudioAnalysis(track)
      }
    },
    []
  )

  // Handle track unsubscribed
  const handleTrackUnsubscribed = useCallback(
    (track: RemoteTrack) => {
      // Cancel audio analysis
      if (audioAnalysisFrameRef.current) {
        cancelAnimationFrame(audioAnalysisFrameRef.current)
        audioAnalysisFrameRef.current = null
      }

      // Remove attached audio element from DOM
      const elements = track.detach()
      elements.forEach(el => {
        if (el.parentNode) {
          el.parentNode.removeChild(el)
        }
      })

      // Clear track reference
      remoteAudioTrackRef.current = null

      setIsRemoteSpeaking(false)
      setAudioLevel(0)
    },
    []
  )

  // Handle data received (transcripts, agent_text, etc.)
  // Format matches PeerTransport handling for consistency
  const handleDataReceived = useCallback(
    (payload: Uint8Array) => {
      try {
        const decoder = new TextDecoder()
        const envelope = JSON.parse(decoder.decode(payload))

        // Handle transcript, transcript_chunk, AND agent_text (like PeerTransport)
        if (envelope.type === 'transcript' || envelope.type === 'transcript_chunk' || envelope.type === 'agent_text') {
          const msgData = envelope.data  // Access nested data

          // Determine role from source field (like PeerTransport)
          const source = msgData.source as string | undefined
          let role: 'user' | 'assistant'

          if (source === 'user_speech' || source === 'user_text') {
            role = 'user'
          } else if (source === 'agent_response' || envelope.type === 'agent_text') {
            role = 'assistant'
          } else {
            role = 'assistant'  // Default to assistant for unknown
          }

          const isFinal = msgData.is_final === true
          const correlationId = msgData.correlation_id
          const text = msgData.text

          if (role === 'user') {
            if (isFinal) {
              setUserTranscript('')

              // Check for optimistic message confirmation by correlation ID
              if (correlationId && pendingCorrelationIds.has(correlationId)) {
                // Confirm the optimistic message
                setMessages(prev => prev.map(msg =>
                  msg.correlationId === correlationId
                    ? { ...msg, deliveryStatus: 'confirmed' as const }
                    : msg
                ))
                setPendingCorrelationIds(prev => {
                  const next = new Set(prev)
                  next.delete(correlationId)
                  return next
                })
                return  // Don't duplicate
              }

              // Also confirm if we have an optimistic message with the same text (fallback)
              // This catches cases where correlation_id might not match exactly
              setMessages(prev => {
                const pendingIdx = prev.findIndex(
                  msg => msg.role === 'user' &&
                         msg.deliveryStatus === 'sending' &&
                         msg.text === text
                )
                if (pendingIdx >= 0) {
                  // Found a matching pending message - confirm it instead of adding duplicate
                  const updated = [...prev]
                  updated[pendingIdx] = { ...updated[pendingIdx], deliveryStatus: 'confirmed' as const }
                  // Also clean up the correlation ID if it exists
                  if (updated[pendingIdx].correlationId) {
                    setPendingCorrelationIds(ids => {
                      const next = new Set(ids)
                      next.delete(updated[pendingIdx].correlationId!)
                      return next
                    })
                  }
                  return updated
                }

                // Check if this exact message was already added recently (within 5 seconds)
                // This prevents duplicates from agent echoes that arrive after confirmation
                const recentDuplicate = prev.find(
                  msg => msg.role === 'user' &&
                         msg.text === text &&
                         Date.now() - msg.timestamp.getTime() < 5000
                )
                if (recentDuplicate) {
                  // Skip - this is a duplicate
                  return prev
                }

                // Regular speech transcript (no correlationId, no pending match) - add it
                return [
                  ...prev,
                  {
                    id: crypto.randomUUID(),
                    role: 'user',
                    text,
                    timestamp: new Date(),
                    deliveryStatus: 'confirmed',
                  },
                ]
              })
            } else {
              setUserTranscript(text)
            }
          } else if (role === 'assistant') {
            // Agent response - streaming display (update existing or add new)
            const transcriptId = msgData.transcript_id || crypto.randomUUID()

            setMessages(prev => {
              const existingIdx = prev.findIndex(m => m.id === transcriptId)
              if (existingIdx >= 0) {
                // Update existing partial message
                const updated = [...prev]
                updated[existingIdx] = {
                  ...updated[existingIdx],
                  text,
                }
                return updated
              } else {
                // Add new message (partial or final)
                return [...prev, {
                  id: transcriptId,
                  role: 'assistant',
                  text,
                  timestamp: new Date(),
                }]
              }
            })
          }
        }
      } catch (error) {
        console.error('Error parsing data:', error)
      }
    },
    [pendingCorrelationIds]
  )

  // Handle room disconnection
  const handleDisconnected = useCallback(() => {
    setConnectionError('Disconnected from session')
    cleanupAudio()
  }, [])

  // Handle participant joined (for real-time notifications)
  const handleParticipantConnected = useCallback((participant: RemoteParticipant) => {
    // Skip agents and the message recorder
    if (participant.identity.startsWith('agent-') || participant.identity === 'message-recorder') {
      return
    }
    // Add join notification to messages
    setMessages(prev => [...prev, {
      id: `join-${participant.identity}-${Date.now()}`,
      role: 'system',
      text: `${participant.name || participant.identity} joined the session`,
      timestamp: new Date(),
      messageType: 'participant_event',
      eventType: 'joined',
      participantName: participant.name || participant.identity,
    }])
  }, [])

  // Handle participant left (for real-time notifications)
  const handleParticipantDisconnected = useCallback((participant: RemoteParticipant) => {
    // Skip agents and the message recorder
    if (participant.identity.startsWith('agent-') || participant.identity === 'message-recorder') {
      return
    }
    // Add leave notification to messages
    setMessages(prev => [...prev, {
      id: `leave-${participant.identity}-${Date.now()}`,
      role: 'system',
      text: `${participant.name || participant.identity} left the session`,
      timestamp: new Date(),
      messageType: 'participant_event',
      eventType: 'left',
      participantName: participant.name || participant.identity,
    }])
  }, [])

  // Calculate RMS (Root Mean Square) amplitude from audio samples
  const calculateRMS = (timeData: Uint8Array): number => {
    let sumSquares = 0
    for (let i = 0; i < timeData.length; i++) {
      // Normalize to -1 to 1 range (Uint8Array is 0-255, center at 128)
      const normalized = (timeData[i] - 128) / 128
      sumSquares += normalized * normalized
    }
    return Math.sqrt(sumSquares / timeData.length)
  }

  // Setup remote audio analysis for visualizer using Web Audio API
  const setupRemoteAudioAnalysis = async (track: RemoteTrack) => {
    try {
      // Create AudioContext if not exists
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext()
      }

      // Resume AudioContext if suspended (browsers require user interaction)
      if (audioContextRef.current.state === 'suspended') {
        console.log('[Participant] AudioContext is suspended, attempting to resume...')
        await audioContextRef.current.resume()
        console.log('[Participant] AudioContext resumed, state:', audioContextRef.current.state)
      }

      // Create source from remote track's MediaStreamTrack
      const mediaStream = new MediaStream([track.mediaStreamTrack])
      const source = audioContextRef.current.createMediaStreamSource(mediaStream)

      // Create analyser for audio content analysis
      const analyser = audioContextRef.current.createAnalyser()
      analyser.fftSize = 2048
      analyser.smoothingTimeConstant = 0.8

      // Connect source to analyser (don't connect to destination - audio already playing via attached element)
      source.connect(analyser)
      analyserRef.current = analyser

      // Start audio level monitoring at 60 FPS
      let lastSpeakingState = false
      let resumeAttempted = false

      const analyzeAudio = async () => {
        if (!analyserRef.current || !remoteAudioTrackRef.current) return

        let audioLevelValue = 0
        let isSpeaking = false

        // Try to resume AudioContext if it's suspended (user interaction may have happened)
        if (audioContextRef.current && audioContextRef.current.state === 'suspended' && !resumeAttempted) {
          resumeAttempted = true
          try {
            await audioContextRef.current.resume()
            console.log('[Participant] AudioContext resumed during monitoring')
          } catch (err) {
            console.warn('[Participant] Could not resume AudioContext:', err)
          }
        }

        if (analyserRef.current && audioContextRef.current?.state === 'running') {
          // Use Web Audio API for accurate audio content analysis
          const bufferLength = analyserRef.current.frequencyBinCount
          const dataArray = new Uint8Array(bufferLength)

          // Get time-domain audio data (waveform) for RMS calculation
          analyserRef.current.getByteTimeDomainData(dataArray)

          // Calculate RMS amplitude (accurate loudness)
          const rms = calculateRMS(dataArray)

          // Normalize to 0.0-1.0 range and amplify for visible animation
          audioLevelValue = Math.min(1.0, rms * 8.0)

          // Speech detection: RMS threshold of 0.02 (empirically tuned)
          isSpeaking = rms > 0.02
        }

        // Update audio level for visualizer animation
        setAudioLevel(audioLevelValue)

        // Only update speaking state if it actually changed
        if (isSpeaking !== lastSpeakingState) {
          setIsRemoteSpeaking(isSpeaking)
          lastSpeakingState = isSpeaking
        }

        // Continue animation loop at 60 FPS
        audioAnalysisFrameRef.current = requestAnimationFrame(analyzeAudio)
      }

      // Start the analysis loop
      audioAnalysisFrameRef.current = requestAnimationFrame(analyzeAudio)
      console.log('[Participant] Started audio level monitoring (Web Audio RMS analysis)')
    } catch (error) {
      console.error('[Participant] Error setting up audio analysis:', error)
    }
  }

  // Toggle microphone - explicitly publish/unpublish audio track (matching session screen approach)
  const toggleMicrophone = useCallback(async () => {
    if (!room || room.state !== 'connected') {
      console.warn('[Participant] Cannot toggle microphone - room not connected')
      return
    }

    try {
      if (isMuted) {
        // Unmute: Get microphone and publish audio track
        console.log('[Participant] 🎤 Starting microphone...')

        // Clean up any existing stream first (like session screen does)
        if (localStreamRef.current) {
          localStreamRef.current.getTracks().forEach(track => track.stop())
          localStreamRef.current = null
        }

        // Get microphone stream with same settings as session screen (startMicWithVu)
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,           // Mono
            sampleRate: 48000,         // High quality input
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: false,    // Match session screen setting
          }
        })
        localStreamRef.current = stream
        console.log('[Participant] ✓ Got microphone stream')

        // Get the audio track from the stream
        const audioTrack = stream.getAudioTracks()[0]
        if (!audioTrack) {
          console.error('[Participant] ✗ No audio track in stream')
          return
        }

        // Publish the audio track to LiveKit (same as PeerTransport.publishAudioTrack)
        console.log('[Participant] 📤 Publishing audio track...')
        const publication = await room.localParticipant.publishTrack(audioTrack)
        publishedAudioTrackRef.current = publication
        console.log('[Participant] ✓ Audio track published:', publication.trackSid)

        setIsMuted(false)
      } else {
        // Mute: Unpublish audio track and stop stream
        console.log('[Participant] 🔇 Stopping microphone...')

        // Unpublish the audio track
        if (publishedAudioTrackRef.current) {
          const track = publishedAudioTrackRef.current.track
          if (track) {
            await room.localParticipant.unpublishTrack(track)
            console.log('[Participant] ✓ Audio track unpublished')
          }
          publishedAudioTrackRef.current = null
        }

        // Stop the media stream
        if (localStreamRef.current) {
          localStreamRef.current.getTracks().forEach(track => {
            track.stop()
            console.log('[Participant] ✓ Stopped track:', track.label)
          })
          localStreamRef.current = null
        }

        setIsMuted(true)
      }
    } catch (error) {
      console.error('[Participant] ✗ Error toggling microphone:', error)
    }
  }, [room, isMuted])

  // Cleanup audio resources
  const cleanupAudio = () => {
    // Cancel audio analysis animation frame
    if (audioAnalysisFrameRef.current) {
      cancelAnimationFrame(audioAnalysisFrameRef.current)
      audioAnalysisFrameRef.current = null
    }

    // Stop local microphone stream
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop())
      localStreamRef.current = null
    }

    // Clear published audio track reference
    publishedAudioTrackRef.current = null

    // Clean up analyser
    if (analyserRef.current) {
      analyserRef.current.disconnect()
      analyserRef.current = null
    }

    if (audioContextRef.current) {
      audioContextRef.current.close()
      audioContextRef.current = null
    }

    // Clear remote track reference
    remoteAudioTrackRef.current = null
  }

  // Handle mouse movement to show/hide controls
  useEffect(() => {
    const handleMouseMove = () => {
      setShowControls(true)

      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current)
      }

      if (!isMuted && !isGalleryOpen && !isChatOpen) {
        hideTimerRef.current = setTimeout(() => {
          setShowControls(false)
        }, 3000)
      }
    }

    handleMouseMove()
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mousedown', handleMouseMove)
    window.addEventListener('touchstart', handleMouseMove)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mousedown', handleMouseMove)
      window.removeEventListener('touchstart', handleMouseMove)

      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current)
      }
    }
  }, [isMuted, isGalleryOpen, isChatOpen])

  // Keep controls visible when panels are open
  useEffect(() => {
    if (isGalleryOpen || isChatOpen || isMuted) {
      setShowControls(true)

      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current)
        hideTimerRef.current = null
      }
    }
  }, [isGalleryOpen, isChatOpen, isMuted])

  // Toggle fullscreen (with Safari compatibility)
  const toggleFullscreen = useCallback(async () => {
    if (!containerRef.current) return

    const element = containerRef.current as HTMLDivElement & {
      webkitRequestFullscreen?: () => Promise<void>
    }
    const doc = document as Document & {
      webkitFullscreenElement?: Element
      webkitExitFullscreen?: () => Promise<void>
    }

    try {
      const isCurrentlyFullscreen = !!(document.fullscreenElement || doc.webkitFullscreenElement)

      if (!isCurrentlyFullscreen) {
        if (element.requestFullscreen) {
          await element.requestFullscreen()
        } else if (element.webkitRequestFullscreen) {
          await element.webkitRequestFullscreen()
        }
        setIsFullscreen(true)
      } else {
        if (document.exitFullscreen) {
          await document.exitFullscreen()
        } else if (doc.webkitExitFullscreen) {
          await doc.webkitExitFullscreen()
        }
        setIsFullscreen(false)
      }
    } catch (error) {
      console.error('Fullscreen error:', error)
    }
  }, [])

  // Listen for fullscreen changes (including Safari)
  useEffect(() => {
    const doc = document as Document & { webkitFullscreenElement?: Element }
    const handleFullscreenChange = () => {
      setIsFullscreen(!!(document.fullscreenElement || doc.webkitFullscreenElement))
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange)
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange)
    }
  }, [])

  // Handle spacebar to toggle mute (and show controls)
  useEffect(() => {
    const handleSpacebar = (event: KeyboardEvent) => {
      if (event.key === ' ' || event.code === 'Space') {
        // Don't toggle if typing in chat
        if (isChatOpen && document.activeElement?.tagName === 'INPUT') return

        event.preventDefault()

        // Show controls when spacebar is pressed
        setShowControls(true)
        if (hideTimerRef.current) {
          clearTimeout(hideTimerRef.current)
        }
        // Set timer to hide controls again (only if will be unmuted after toggle)
        if (isMuted) {
          // Will be unmuted - set timer to hide
          hideTimerRef.current = setTimeout(() => {
            setShowControls(false)
          }, 3000)
        }

        toggleMicrophone()
      }
    }

    document.addEventListener('keydown', handleSpacebar)
    return () => {
      document.removeEventListener('keydown', handleSpacebar)
    }
  }, [toggleMicrophone, isChatOpen, isMuted])

  // Loading state
  if (isConnecting) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="fixed inset-0 flex items-center justify-center z-10"
      >
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-violet-400 mx-auto mb-4" />
          <p className="text-white/50 text-sm">Connecting to session...</p>
        </div>
      </motion.div>
    )
  }

  // Error state
  if (connectionError) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="fixed inset-0 flex items-center justify-center z-10 p-6"
      >
        <div className="max-w-md w-full text-center">
          <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4">
            <X className="w-6 h-6 text-red-400" />
          </div>
          <h2 className="text-lg font-light text-white mb-2">Connection Error</h2>
          <p className="text-white/50 text-sm">{connectionError}</p>
        </div>
      </motion.div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-10"
    >
      {/* Fullscreen container wrapper */}
      <div
        ref={containerRef}
        className="absolute inset-0"
        style={{ backgroundColor: currentVisualizer === 'face' ? '#000000' : undefined }}
      >
      {/* Visualizer */}
      <div className="absolute inset-0 flex items-center justify-center">
        <VisualizerRenderer
          type={currentVisualizer}
          audioLevel={audioLevel}
          isRemoteSpeaking={isRemoteSpeaking}
          isUserSpeaking={!isMuted}
        />
      </div>

      {/* Top-right control buttons */}
      <motion.div
        className={`absolute top-6 right-6 flex gap-3 z-50 transition-opacity duration-300 ${
          showControls && !isGalleryOpen && !isChatOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Microphone Button */}
        <motion.button
          onClick={toggleMicrophone}
          className={`p-3 rounded-full backdrop-blur-sm border transition-all duration-300 hover:scale-110 ${
            isMuted
              ? 'bg-red-500/20 border-red-400/40 text-red-400'
              : 'bg-green-500/20 border-green-400/40 text-green-400'
          }`}
          title={isMuted ? 'Unmute microphone (Space)' : 'Mute microphone (Space)'}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.95 }}
        >
          {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
        </motion.button>

        {/* Chat Button */}
        <motion.button
          onClick={() => setIsChatOpen(true)}
          className="p-3 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 text-white transition-all duration-300 hover:bg-white/20 hover:scale-110"
          title="Open chat"
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.95 }}
        >
          <MessageSquare className="w-5 h-5" />
        </motion.button>

        {/* Subtitles Toggle */}
        <motion.button
          onClick={() => setShowSubtitles(!showSubtitles)}
          className={`p-3 rounded-full backdrop-blur-sm border transition-all duration-300 hover:scale-110 ${
            showSubtitles
              ? 'bg-white/20 border-white/30 text-white'
              : 'bg-white/10 border-white/20 text-white/40'
          }`}
          title={showSubtitles ? 'Hide subtitles' : 'Show subtitles'}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.95 }}
        >
          <Subtitles className={`w-5 h-5 ${!showSubtitles ? 'opacity-50' : ''}`} />
        </motion.button>

        {/* Gallery Button (only if not locked) */}
        {!sessionData.visualizerLocked && (
          <motion.button
            onClick={() => setIsGalleryOpen(true)}
            className="p-3 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 text-white transition-all duration-300 hover:bg-white/20 hover:scale-110"
            title="Visualizer gallery"
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
          >
            <LayoutGrid className="w-5 h-5" />
          </motion.button>
        )}

        {/* Fullscreen Button */}
        <motion.button
          onClick={toggleFullscreen}
          className="p-3 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 text-white transition-all duration-300 hover:bg-white/20 hover:scale-110"
          title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.95 }}
        >
          {isFullscreen ? (
            <Minimize2 className="w-5 h-5" />
          ) : (
            <Maximize2 className="w-5 h-5" />
          )}
        </motion.button>
      </motion.div>

      {/* Visualizer Gallery */}
      {!sessionData.visualizerLocked && (
        <VisualizerGallery
          isOpen={isGalleryOpen}
          onClose={() => setIsGalleryOpen(false)}
          currentVisualizer={currentVisualizer}
          onSelect={setCurrentVisualizer}
        />
      )}

      {/* Chat Panel */}
      <ParticipantChatPanel
        isOpen={isChatOpen}
        onClose={() => setIsChatOpen(false)}
        messages={messages}
        room={room}
        participantName={sessionData.participantName}
        isLoadingHistory={isLoadingHistory}
        onSendOptimisticMessage={(message) => {
          setMessages(prev => [...prev, message])
          if (message.correlationId) {
            setPendingCorrelationIds(prev => {
              const next = new Set(prev)
              next.add(message.correlationId!)
              return next
            })
          }
        }}
      />

      {/* Transcript Overlay */}
      <TranscriptOverlay
        transcript={userTranscript}
        theme={currentVisualizer}
        isVisible={showSubtitles}
      />

      {/* Bottom hint */}
      <motion.div
        className={`absolute bottom-4 left-1/2 -translate-x-1/2 z-40 transition-opacity duration-300 ${
          showControls && !isGalleryOpen && !isChatOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div className="text-white/40 text-sm flex items-center gap-2">
          <span>Press</span>
          <kbd className="px-2 py-1 bg-white/10 rounded text-xs">Space</kbd>
          <span>to {isMuted ? 'unmute' : 'mute'}</span>
        </div>
      </motion.div>

      {/* Participant name badge */}
      <motion.div
        className={`absolute bottom-4 right-6 z-40 transition-opacity duration-300 ${
          showControls && !isGalleryOpen && !isChatOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div className="bg-white/10 backdrop-blur-sm border border-white/20 rounded-full px-4 py-2 text-white/70 text-sm">
          {sessionData.participantName}
        </div>
      </motion.div>
      </div>{/* End fullscreen container wrapper */}
    </motion.div>
  )
}
