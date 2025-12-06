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
import { Room, RoomEvent, Track, RemoteTrack, RemoteTrackPublication } from 'livekit-client'
import TranscriptOverlay from '../face/TranscriptOverlay'
import VisualizerGallery from '../face/VisualizerGallery'
import VisualizerRenderer from '../face/VisualizerRenderer'
import ParticipantChatPanel from './ParticipantChatPanel'
import { VisualizerType } from '../face/types'
import { apiClient } from '../../services/ApiClient'

interface ConnectionInfo {
  token: string
  serverUrl: string
  roomName: string
}

interface SessionData {
  participantId: string
  participantName: string
  identity: string
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
  const [messages, setMessages] = useState<Array<{
    id: string
    role: 'user' | 'assistant'
    text: string
    timestamp: Date
  }>>([])

  // Refs
  const containerRef = useRef<HTMLDivElement>(null)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
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

  // Handle track subscribed (for receiving agent audio)
  const handleTrackSubscribed = useCallback(
    (track: RemoteTrack, publication: RemoteTrackPublication) => {
      if (track.kind === Track.Kind.Audio) {
        const audioElement = track.attach()
        audioElement.play()

        // Set up audio analysis for visualizer
        setupRemoteAudioAnalysis(audioElement)
      }
    },
    []
  )

  // Handle track unsubscribed
  const handleTrackUnsubscribed = useCallback(
    (track: RemoteTrack) => {
      track.detach()
      setIsRemoteSpeaking(false)
    },
    []
  )

  // Handle data received (transcripts, etc.)
  const handleDataReceived = useCallback(
    (payload: Uint8Array) => {
      try {
        const decoder = new TextDecoder()
        const data = JSON.parse(decoder.decode(payload))

        if (data.type === 'transcript') {
          if (data.role === 'user') {
            if (data.is_final) {
              setUserTranscript('')
              setMessages(prev => [
                ...prev,
                {
                  id: crypto.randomUUID(),
                  role: 'user',
                  text: data.text,
                  timestamp: new Date(),
                },
              ])
            } else {
              setUserTranscript(data.text)
            }
          } else if (data.role === 'assistant') {
            if (data.is_final) {
              setMessages(prev => [
                ...prev,
                {
                  id: crypto.randomUUID(),
                  role: 'assistant',
                  text: data.text,
                  timestamp: new Date(),
                },
              ])
            }
          }
        }
      } catch (error) {
        console.error('Error parsing data:', error)
      }
    },
    []
  )

  // Handle room disconnection
  const handleDisconnected = useCallback(() => {
    setConnectionError('Disconnected from session')
    cleanupAudio()
  }, [])

  // Setup remote audio analysis for visualizer
  const setupRemoteAudioAnalysis = (audioElement: HTMLAudioElement) => {
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext()
      }

      const source = audioContextRef.current.createMediaElementSource(audioElement)
      const analyser = audioContextRef.current.createAnalyser()
      analyser.fftSize = 256

      source.connect(analyser)
      analyser.connect(audioContextRef.current.destination)
      analyserRef.current = analyser

      // Start audio level monitoring
      const dataArray = new Uint8Array(analyser.frequencyBinCount)
      const updateLevel = () => {
        if (!analyserRef.current) return

        analyserRef.current.getByteFrequencyData(dataArray)
        const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length
        const normalizedLevel = average / 255

        setAudioLevel(normalizedLevel)
        setIsRemoteSpeaking(normalizedLevel > 0.1)

        requestAnimationFrame(updateLevel)
      }
      updateLevel()
    } catch (error) {
      console.error('Error setting up audio analysis:', error)
    }
  }

  // Toggle microphone
  const toggleMicrophone = useCallback(async () => {
    if (!room) return

    try {
      if (isMuted) {
        // Start microphone
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        localStreamRef.current = stream

        await room.localParticipant.setMicrophoneEnabled(true)
        setIsMuted(false)
      } else {
        // Stop microphone
        await room.localParticipant.setMicrophoneEnabled(false)

        if (localStreamRef.current) {
          localStreamRef.current.getTracks().forEach(track => track.stop())
          localStreamRef.current = null
        }

        setIsMuted(true)
      }
    } catch (error) {
      console.error('Error toggling microphone:', error)
    }
  }, [room, isMuted])

  // Cleanup audio resources
  const cleanupAudio = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop())
      localStreamRef.current = null
    }

    if (audioContextRef.current) {
      audioContextRef.current.close()
      audioContextRef.current = null
    }

    analyserRef.current = null
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

  // Toggle fullscreen
  const toggleFullscreen = useCallback(async () => {
    if (!containerRef.current) return

    try {
      if (!document.fullscreenElement) {
        await containerRef.current.requestFullscreen()
        setIsFullscreen(true)
      } else {
        await document.exitFullscreen()
        setIsFullscreen(false)
      }
    } catch (error) {
      console.error('Fullscreen error:', error)
    }
  }, [])

  // Listen for fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement)
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
    }
  }, [])

  // Handle spacebar to toggle mute
  useEffect(() => {
    const handleSpacebar = (event: KeyboardEvent) => {
      if (event.key === ' ' || event.code === 'Space') {
        // Don't toggle if typing in chat
        if (isChatOpen && document.activeElement?.tagName === 'INPUT') return

        event.preventDefault()
        toggleMicrophone()
      }
    }

    document.addEventListener('keydown', handleSpacebar)
    return () => {
      document.removeEventListener('keydown', handleSpacebar)
    }
  }, [toggleMicrophone, isChatOpen])

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
      ref={containerRef}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-10"
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
    </motion.div>
  )
}
